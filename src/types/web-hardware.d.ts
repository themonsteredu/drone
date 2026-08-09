interface BrowserSerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
  bluetoothServiceClassId?: string;
}

interface BrowserSerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
  bufferSize?: number;
  flowControl?: "none" | "hardware";
}

interface BrowserSerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: BrowserSerialOptions): Promise<void>;
  close(): Promise<void>;
  forget?(): Promise<void>;
  getInfo(): BrowserSerialPortInfo;
}

interface BrowserSerial extends EventTarget {
  requestPort(options?: {
    filters?: Array<{
      usbVendorId?: number;
      usbProductId?: number;
      bluetoothServiceClassId?: string;
    }>;
    allowedBluetoothServiceClassIds?: string[];
  }): Promise<BrowserSerialPort>;
  getPorts(): Promise<BrowserSerialPort[]>;
}

interface BrowserHidDevice {
  opened: boolean;
  productName: string;
  vendorId: number;
  productId: number;
}

interface BrowserHid {
  getDevices(): Promise<BrowserHidDevice[]>;
}

interface BrowserUsbDevice {
  opened: boolean;
  productName?: string;
  manufacturerName?: string;
  serialNumber?: string;
  vendorId: number;
  productId: number;
}

interface BrowserUsb {
  getDevices(): Promise<BrowserUsbDevice[]>;
}

interface Navigator {
  readonly serial?: BrowserSerial;
  readonly hid?: BrowserHid;
  readonly usb?: BrowserUsb;
}
