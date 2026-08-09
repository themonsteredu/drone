import type { DetectionContext, DeviceInfo, AdapterMatch } from "../types";
import { ByrobotSerialBaseAdapter } from "./byrobot-serial-base";
import { SMART_CONTROLLER_PROFILE } from "../profiles";

/**
 * Placeholder: no official Smart Controller USB descriptor/model signature has
 * been confirmed. Payload mapping intentionally remains unimplemented.
 */
export class SmartControllerAdapter extends ByrobotSerialBaseAdapter {
  override readonly controllerProfile = SMART_CONTROLLER_PROFILE;
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
