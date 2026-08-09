import type { DetectionContext, DeviceInfo, AdapterMatch } from "../types";
import { ByrobotSerialBaseAdapter } from "./byrobot-serial-base";
import { BATTLE_DRONE_PROFILE } from "../profiles";

// Official Coding Drone definitions: Battle Drone Controller USB model number.
export const BATTLE_DRONE_CONTROLLER_USB_MODEL_NUMBER = 0x00032004;

/** Payload mapping remains intentionally empty until a real controller capture. */
export class BattleDroneAdapter extends ByrobotSerialBaseAdapter {
  override readonly controllerProfile = BATTLE_DRONE_PROFILE;
  constructor(port: BrowserSerialPort, baudRate: number) {
    super(port, baudRate, "byrobot-battle-drone", "BYROBOT Battle Drone Controller");
  }

  override matches(
    deviceInfo: DeviceInfo,
    context: DetectionContext = {},
  ): AdapterMatch {
    if (
      deviceInfo.method === "serial" &&
      context.reportedModelNumber === BATTLE_DRONE_CONTROLLER_USB_MODEL_NUMBER
    ) {
      return {
        confidence: "confirmed",
        score: 100,
        evidence: ["Official model number 0x00032004 reported by the controller."],
      };
    }
    if (deviceInfo.method === "serial" && context.modelHint === "battle-drone") {
      return {
        confidence: "candidate",
        score: 40,
        evidence: ["User-supplied hint; Information model number not observed."],
      };
    }
    return { confidence: "none", score: 0, evidence: [] };
  }
}
