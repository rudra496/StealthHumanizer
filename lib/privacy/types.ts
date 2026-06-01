// 📋 NOOB EXPLAINER: Types for Privacy Mode
// These are the "shapes" of data that Privacy Mode uses.
// Think of them as templates that tell TypeScript what data to expect.

export interface PrivacyModeConfig {
  // 🎯 NOOB EXPLAINER: Which model to use
  // 'small' = fast but basic (good for phones)
  // 'medium' = balanced (good for laptops)
  // 'large' = best quality but slow (good for desktops)
  modelSize: 'small' | 'medium' | 'large';
  
  // 🌐 NOOB EXPLAINER: Web Worker usage
  // Web Workers run code in a background thread so the UI doesn't freeze.
  // Always true unless you're in a very old browser.
  useWebWorker: boolean;
  
  // 📊 NOOB EXPLAINER: Progress callback
  // This function gets called with progress updates so we can show
  // a loading bar while the model downloads/loads.
  onProgress?: (progress: number, status: string) => void;
}

export interface PrivacyModeResult {
  // ✅ The humanized text
  text: string;
  
  // 📊 How much the text changed (0-1, higher = more changes)
  modificationScore: number;
  
  // ⏱️ How long the processing took in milliseconds
  processingTimeMs: number;
  
  // 🤖 Which model was used
  modelUsed: string;
  
  // 💻 Whether a Web Worker was used
  usedWebWorker: boolean;
}

export interface DeviceCapabilities {
  // 🧠 NOOB EXPLAINER: What can this device handle?
  // We check the device's capabilities to recommend the best model size.
  
  // Does the browser support Web Workers? (needed for smooth UI)
  hasWebWorker: boolean;
  
  // Does the browser support WebAssembly? (needed for ML models)
  hasWasm: boolean;
  
  // How much memory does the device have? (in GB, approximate)
  estimatedMemoryGB: number;
  
  // Number of CPU cores (more = faster processing)
  cpuCores: number;
  
  // Is this a mobile device? (mobile = use smaller model)
  isMobile: boolean;
  
  // Recommended model size based on device
  recommendedModelSize: 'small' | 'medium' | 'large';
}
