import type { DetectionContext, DeviceInfo, AdapterMatch } from "../types";
import { ByrobotSerialBaseAdapter } from "./byrobot-serial-base";
import { PRC95_PROFILE } from "../profiles";

/**
 * Placeholder: PRC-95 could not be matched to an official BYROBOT protocol
 * identifier. Do not treat it as BRB-95 without device evidence.
 */
export class Prc95Adapter extends ByrobotSerialBaseAdapter {
  override readonly controllerProfile = PRC95_PROFILE;
  constructor(port: BrowserSerialPort, baudRate: number) {
    super(port, baudRate, "byrobot-prc95", "PRC-95 (unverified)");
  }

  override matches(
    deviceInfo: DeviceInfo,
    context: DetectionContext = {},
  ): AdapterMatch {
    if (deviceInfo.method === "serial" && context.modelHint === "prc95") {
      return {
        confidence: "candidate",
        score: 30,
        evidence: ["User-supplied model hint only; official identifier unverified."],
      };
    }
    return { confidence: "none", score: 0, evidence: [] };
  }
}
