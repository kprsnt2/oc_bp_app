import { openAiCompatibleAdapter } from "./openaiCompatible";

export const nvidiaAdapter = openAiCompatibleAdapter(
  "nvidia",
  "NVIDIA",
  "https://integrate.api.nvidia.com/v1",
  ["NVIDIA_API_KEY", "NVIDIA_API_TOKEN"],
);
