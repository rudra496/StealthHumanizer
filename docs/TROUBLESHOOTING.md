# Troubleshooting Guide

This guide helps you resolve common issues with StealthHumanizer.

## Table of Contents
- [API Key Issues](#api-key-issues)
- [Provider Connection Issues](#provider-connection-issues)
- [Build and Installation Issues](#build-and-installation-issues)
- [Performance Issues](#performance-issues)

---

## API Key Issues

### "Invalid API Key" Error

**Symptom**: When you save an API key, you get an "Invalid API Key" error.

**Solutions**:

1. **Verify Key Format**
   - Gemini keys start with `AIza`
   - OpenAI keys start with `sk-`
   - Groq keys start with `gsk_`
   - Anthropic (Claude) keys start with `sk-ant-`
   - Check that you copied the **entire** key without any spaces

2. **Generate a New Key**
   - Sometimes keys are deactivated or expire
   - Go to your provider's dashboard and generate a fresh API key
   - Delete the old key from Settings before adding the new one

3. **Check Provider Status**
   - Visit the provider's status page to ensure their API service is operational
   - [Google Cloud Status](https://status.cloud.google.com/)
   - [OpenAI Status](https://status.openai.com/)
   - [Anthropic Status](https://status.anthropic.com/)

4. **Clear Browser Storage**

   ```javascript
   // Open browser console (F12) and run:
   localStorage.clear();
   // Then refresh the page and re-enter your keys
   ```

5. **Test Key Manually**
   - After saving, click the "Test Key" button in Settings
   - This makes a minimal API call to verify the key works

### Key Saves But Doesn't Work

**Symptom**: Key is saved successfully, but humanization fails.

**Solutions**:

1. **Check API Quota**
   - Free tier keys have rate limits and quotas
   - Check your usage in the provider's dashboard
   - Wait a few minutes and try again

2. **Verify Network Connection**
   - API calls go directly from your browser to the provider
   - Check that your firewall/network isn't blocking the provider's domain

3. **Try a Different Provider**
   - If one provider is having issues, switch to another
   - Gemini and Groq both offer free tiers

---

## Provider Connection Issues

### Connection Timeout

**Symptom**: Request hangs for a long time, then fails with a timeout error.

**Solutions**:

1. **Check Network Connection**
   - Ensure you have a stable internet connection
   - Try accessing the provider's website directly

2. **Reduce Text Length**
   - Very long texts may timeout
   - Try breaking your text into smaller chunks using Batch mode

3. **Try Different Provider**
   - Some providers are faster than others
   - Groq and Gemini are typically the fastest

### CORS or Network Errors

**Symptom**: Browser console shows CORS or network-related errors.

**Solutions**:

1. **Disable Browser Extensions**
   - Ad blockers and privacy extensions can interfere with API calls
   - Try in an incognito/private window

2. **Update Your Browser**
   - Ensure you're using a modern browser version
   - Chrome, Firefox, Edge, and Safari are all supported

---

## Build and Installation Issues

### `npm install` Fails

**Solutions**:

1. **Check Node Version**

   ```bash
   node --version  # Should be 20 or higher
   ```

2. **Clear npm Cache**

   ```bash
   npm cache clean --force
   rm -rf node_modules package-lock.json
   npm install
   ```

3. **Use npm Instead of Other Package Managers**

   ```bash
   npm install
   # Not: yarn install or pnpm install (unless you know what you're doing)
   ```

### `npm run build` Fails

**Solutions**:

1. **Check TypeScript Errors**

   ```bash
   npm run build
   # Read the error messages carefully
   ```

2. **Ensure Dependencies Are Installed**

   ```bash
   npm ci
   ```

### `npm run dev` Doesn't Start

**Solutions**:

1. **Check Port Availability**
   - Port 3000 must be available
   - Try: `lsof -i :3000` (Mac/Linux) or `netstat -ano | findstr :3000` (Windows)
   - Kill any process using port 3000

2. **Clear Next.js Cache**

   ```bash
   rm -rf .next
   npm run dev
   ```

---

## Performance Issues

### Slow Humanization

**Solutions**:

1. **Use Faster Providers**
   - Groq and Cerebras are the fastest (free)
   - Gemini Flash is also very fast

2. **Reduce Rewrite Level**
   - "Light" and "Medium" are faster than "Aggressive" and "Ninja"
   - Ninja mode does multiple passes, which takes longer

3. **Shorten Text**
   - Break very long texts into smaller chunks
   - Use Batch mode for multiple texts

### Browser Becomes Unresponsive

**Solutions**:

1. **Close Other Tabs**
   - StealthHumanizer is memory-intensive
   - Close unnecessary browser tabs

2. **Don't Spam "Humanize" Button**
   - Wait for the current request to complete
   - Multiple simultaneous requests can overload your browser

3. **Refresh the Page**
   - Sometimes browser state gets corrupted
   - Refresh and try again

---

## Still Having Issues?

If none of these solutions work:

1. **Check Existing Issues**: [GitHub Issues](https://github.com/rudra496/StealthHumanizer/issues)
2. **Open a New Issue**: Use the appropriate issue template
3. **Provide Details**:
   - Browser and version
   - Operating system
   - Provider you're using
   - Complete error message
   - Steps to reproduce

---

## Common Questions

### Why is my API key not saving?

Make sure you're not in incognito/private browsing mode, which may block localStorage.

### Can I use multiple providers at once?

Yes! You can save keys for multiple providers and switch between them in the Humanizer settings.

### Is my data secure?

Yes. API keys are stored **only** in your browser's localStorage. They never leave your device. Text goes directly from your browser to the provider you choose.

### How do I delete all my API keys?

Go to Settings → Danger Zone → Clear All API Keys.

---

For more help, visit the [SUPPORT.md](../SUPPORT.md) document or open an issue on GitHub.
