const input = document.getElementById('baseUrl');
const status = document.getElementById('status');
chrome.storage.sync.get('baseUrl').then(({ baseUrl }) => { input.value = baseUrl || 'http://localhost:3000'; });
document.getElementById('save').addEventListener('click', async () => {
  await chrome.storage.sync.set({ baseUrl: input.value.trim() || 'http://localhost:3000' });
  status.textContent = 'Saved.';
});
