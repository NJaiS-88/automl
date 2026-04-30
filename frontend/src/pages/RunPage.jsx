import { useNavigate } from "react-router-dom";
import RunForm from "../components/RunForm";
import { useRunStore } from "../store";

function RunPage() {
  const navigate = useNavigate();
  const { executeRun, loading, error } = useRunStore();

  const handleRun = async (payload) => {
    const data = await executeRun(payload);
    navigate(`/history/${data._id}`);
  };

  return (
    <div className="grid-one">
      <RunForm onSubmit={handleRun} loading={loading} />
      <div className="panel">
        <h2>Workflow</h2>
        <ol>
          <li>Upload dataset</li>
          <li>Select target column</li>
          <li>Train and optimize with existing Python pipeline</li>
          <li>Explore full report and predict with trained model</li>
        </ol>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  );
}

export default RunPage;
