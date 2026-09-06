import { ControllerDiagnosticsPage } from "@/src/components/controller-diagnostics";
import { CareerLogProvider } from "@/src/components/career-log-provider";

export default function Home() {
  return <CareerLogProvider><ControllerDiagnosticsPage /></CareerLogProvider>;
}
