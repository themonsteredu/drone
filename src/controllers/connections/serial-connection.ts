import type { ControllerError, ControllerErrorCode } from "../types";

interface SerialConnectionCallbacks {
  onBytes: (bytes: Uint8Array, receivedAt: number) => void;
  onError: (error: ControllerError) => void;
  onUnexpectedClose?: () => void;
}

export interface SerialConnectionOptions {
  baudRate: number;
  dataBits: 8;
  parity: "none";
  stopBits: 1;
}

const errorMessages: Record<ControllerErrorCode, string> = {
  web_serial_unsupported: "이 브라우저는 Web Serial을 지원하지 않습니다.",
  permission_denied: "시리얼 포트 권한이 거절되었습니다.",
  port_unavailable: "선택한 COM 포트를 사용할 수 없습니다.",
  port_already_open: "시리얼 포트가 이미 열려 있습니다.",
  read_failed: "시리얼 데이터를 읽는 중 오류가 발생했습니다.",
  write_failed: "시리얼 포트로 데이터를 보내지 못했습니다.",
  no_data: "포트는 열렸지만 데이터가 수신되지 않았습니다.",
  no_start_code: "수신 데이터에서 BYROBOT 시작 코드를 찾지 못했습니다.",
  baud_mismatch_suspected: "baud rate가 장치 설정과 다를 가능성이 있습니다.",
  crc_error: "CRC가 맞지 않는 패킷을 수신했습니다.",
  unsupported_controller: "현재 지원되지 않는 조종기입니다.",
  adapter_unavailable: "이 조종기의 입력 매핑 adapter가 아직 없습니다.",
};

export function controllerError(
  code: ControllerErrorCode,
  error?: unknown,
): ControllerError {
  return {
    code,
    message: errorMessages[code],
    detail: error instanceof Error ? error.message : undefined,
    at: Date.now(),
  };
}

function classifyOpenError(error: unknown): ControllerError {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return controllerError("permission_denied", error);
  }

  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("already") || message.includes("open")) {
    return controllerError("port_already_open", error);
  }

  return controllerError("port_unavailable", error);
}

export class SerialConnection {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readLoopPromise: Promise<void> | null = null;
  private opened = false;
  private closing = false;

  constructor(
    readonly port: BrowserSerialPort,
    private readonly callbacks: SerialConnectionCallbacks,
  ) {}

  get isOpen(): boolean {
    return this.opened;
  }

  get info(): BrowserSerialPortInfo {
    return this.port.getInfo();
  }

  async open(options: SerialConnectionOptions): Promise<void> {
    if (this.opened || this.port.readable) {
      throw controllerError("port_already_open");
    }

    try {
      await this.port.open({
        baudRate: options.baudRate,
        dataBits: options.dataBits,
        parity: options.parity,
        stopBits: options.stopBits,
        flowControl: "none",
      });
    } catch (error) {
      throw classifyOpenError(error);
    }

    if (!this.port.readable) {
      throw controllerError("port_unavailable");
    }

    this.opened = true;
    this.closing = false;
    this.readLoopPromise = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    try {
      while (this.opened && this.port.readable) {
        this.reader = this.port.readable.getReader();
        try {
          while (this.opened) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (value?.byteLength) {
              this.callbacks.onBytes(value.slice(), Date.now());
            }
          }
        } finally {
          this.reader.releaseLock();
          this.reader = null;
        }

        if (this.opened) break;
      }
    } catch (error) {
      if (!this.closing) {
        this.callbacks.onError(controllerError("read_failed", error));
      }
    } finally {
      if (!this.closing && this.opened) {
        this.opened = false;
        this.callbacks.onUnexpectedClose?.();
      }
    }
  }

  async write(bytes: Uint8Array): Promise<void> {
    if (!this.opened || !this.port.writable) {
      throw controllerError("port_unavailable");
    }

    const writer = this.port.writable.getWriter();
    try {
      await writer.write(bytes.slice());
    } catch (error) {
      throw controllerError("write_failed", error);
    } finally {
      writer.releaseLock();
    }
  }

  async close(): Promise<void> {
    if (!this.opened && !this.port.readable && !this.port.writable) return;

    this.closing = true;
    this.opened = false;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // A removed USB device can reject cancel; the read loop still releases its lock.
      }
    }

    try {
      await this.readLoopPromise;
    } catch {
      // Read failures are reported by the loop callback.
    }

    if (this.port.readable || this.port.writable) {
      try {
        await this.port.close();
      } catch (error) {
        this.callbacks.onError(controllerError("port_unavailable", error));
      }
    }

    this.readLoopPromise = null;
    this.closing = false;
  }
}
