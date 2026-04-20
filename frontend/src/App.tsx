import { TopologyCanvas } from "./components/TopologyCanvas";
import { useWasmEngine } from "./hooks/useWasmEngine";
import "./index.css";

function App() {
  useWasmEngine();

  return (
    <div className="w-full h-full">
      <TopologyCanvas />
    </div>
  );
}

export default App;
