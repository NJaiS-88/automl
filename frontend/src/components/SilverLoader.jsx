import { FiLoader } from "react-icons/fi";

function SilverLoader({ text = "Loading..." }) {
  return (
    <div className="silver-loader-wrap" role="status" aria-live="polite">
      <FiLoader className="silver-loader-icon spin" />
      <p>{text}</p>
    </div>
  );
}

export default SilverLoader;
