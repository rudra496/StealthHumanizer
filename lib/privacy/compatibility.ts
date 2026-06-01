// 🖥️ NOOB EXPLAINER: Browser compatibility check
// Not all browsers can run AI models. This file checks if the user's
// browser is capable and recommends the best settings.

import type { DeviceCapabilities } from './types';

// 🔍 NOOB EXPLAINER: What are we checking?
// 1. Web Workers — needed so the AI doesn't freeze the page
// 2. WebAssembly — needed for the AI model to run at reasonable speed
// 3. Memory — AI models need lots of RAM
// 4. CPU cores — more cores = faster processing
// 5. Mobile detection — phones can't handle large models
export function getDeviceCapabilities(): DeviceCapabilities {
  const hasWebWorker = typeof Worker !== 'undefined';
  const hasWasm = typeof WebAssembly !== 'undefined';
  const cpuCores = navigator?.hardwareConcurrency || 2;
  
  // 📱 NOOB EXPLAINER: Mobile detection
  // Mobile devices typically have less memory and slower CPUs.
  // We detect them by checking the screen size and user agent.
  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator?.userAgent || ''
  ) || (typeof window !== 'undefined' && window.innerWidth < 768);

  // 🧠 NOOB EXPLAINER: Memory estimation
  // We can't directly measure how much RAM the user has, but we can
  // estimate based on the device type and number of CPU cores.
  // This is a rough heuristic — not exact.
  let estimatedMemoryGB = 4; // Default assumption
  if (isMobile) {
    estimatedMemoryGB = 2;
  } else if (cpuCores >= 8) {
    estimatedMemoryGB = 16;
  } else if (cpuCores >= 4) {
    estimatedMemoryGB = 8;
  }

  // 🎯 NOOB EXPLAINER: Model size recommendation
  // We pick the best model size based on device capabilities.
  // Small models work everywhere but produce lower quality.
  // Large models need beefy hardware but produce great results.
  let recommendedModelSize: 'small' | 'medium' | 'large';
  if (isMobile || estimatedMemoryGB < 4) {
    recommendedModelSize = 'small';
  } else if (estimatedMemoryGB < 8 || cpuCores < 4) {
    recommendedModelSize = 'medium';
  } else {
    recommendedModelSize = 'large';
  }

  return {
    hasWebWorker,
    hasWasm,
    estimatedMemoryGB,
    cpuCores,
    isMobile,
    recommendedModelSize,
  };
}

// ✅ NOOB EXPLAINER: Can this browser run Privacy Mode?
// Returns true if the browser supports the minimum requirements.
export function isPrivacyModeSupported(): boolean {
  const caps = getDeviceCapabilities();
  return caps.hasWebWorker && caps.hasWasm;
}
