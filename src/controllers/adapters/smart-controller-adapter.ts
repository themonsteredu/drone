import type { DetectionContext, DeviceInfo, AdapterMatch } from "../types";
import { ByrobotSerialBaseAdapter } from "./byrobot-serial-base";

/**
 * Placeholder: no official Smart Controller USB descriptor/model signature has
 * been confirmed. Payload mapping intentionally remains unimplemented.
 */
export class SmartControllerAdapter extends ByrobotSerialBaseAdapter {
  constructor(port: BrowserSerialPort, baudRate: number) {
    super(
      port,
      baudRate,
      "byrobot-smart-controller",
      "BYROBOT Smart Controller (unverified)",
    );
  }

  override matches(
    deviceInfo: DeviceInfo,
    context: DetectionContext = {},
  ): AdapterMatch {
    if (deviceInfo.method === "serial" && context.modelHint === "smart-controller") {
      return {
        confidence: "candidate",
        score: 40,
        evidence: ["User-supplied model hint only; USB/protocol signature unverified."],
      };
    }
    return { confidence: "none", score: 0, evidence: [] };
  }
}
