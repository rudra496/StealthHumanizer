// 🔒 NOOB EXPLAINER: What is Client-Side Privacy Mode?
// Normally, when you humanize text, it gets sent to an AI company's
// servers (like OpenAI or Google). That means your text travels across
// the internet and sits on someone else's computer.
//
// With Privacy Mode, the AI model runs INSIDE YOUR BROWSER. Your text
// never leaves your device. It's like having a private translator in
// your room instead of sending letters to a translation service.
//
// Trade-offs:
// ✅ Your text NEVER leaves your device (100% private)
// ✅ No API key needed (it's free!)
// ❌ Smaller models = slightly lower quality than GPT-4
// ❌ First load takes ~30 seconds to download the model
// ❌ Uses your device's CPU/memory

export { PrivacyModeEngine } from './engine';
export { isPrivacyModeSupported, getDeviceCapabilities } from './compatibility';
export type { PrivacyModeConfig, PrivacyModeResult, DeviceCapabilities } from './types';
