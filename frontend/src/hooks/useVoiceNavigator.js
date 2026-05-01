import { useMemo } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .trim();
}

export default function useVoiceNavigator(commandsConfig = []) {
  const commands = useMemo(
    () =>
      commandsConfig.map((item) => ({
        command: item.phrases,
        callback: (...args) => {
          const spoken = args.at(-1)?.command || "";
          item.onMatch?.(normalize(spoken));
        },
      })),
    [commandsConfig]
  );

  const {
    transcript,
    listening,
    browserSupportsSpeechRecognition,
    resetTranscript,
  } = useSpeechRecognition({ commands });

  const start = () =>
    SpeechRecognition.startListening({
      continuous: true,
      language: "en-IN",
    });

  const stop = () => SpeechRecognition.stopListening();

  return {
    transcript,
    listening,
    browserSupportsSpeechRecognition,
    resetTranscript,
    start,
    stop,
  };
}
