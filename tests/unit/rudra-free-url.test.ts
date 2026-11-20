import { afterEach, describe, expect, it, vi } from 'vitest';
import { primaryBase, rudraFetch } from '../../lib/server/rudra-free';

const KNOWN = 'https://cargo-banners-features-near.trycloudflare.com';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RUDRA_API_BASE_URL;
});

describe('Rudra free URL resolution', () => {
  it('uses a custom HTTPS override', () => {
    process.env.RUDRA_API_BASE_URL = 'https://free.example.com///';
    expect(primaryBase()).toBe('https://free.example.com');
  });
  it('ignores legacy sslip.io override', () => {
    process.env.RUDRA_API_BASE_URL = 'https://legacy.sslip.io';
    expect(primaryBase()).toBe(KNOWN);
  });
  it('ignores legacy IP override', () => {
    process.env.RUDRA_API_BASE_URL = 'http://129.159.229.170';
    expect(primaryBase()).toBe(KNOWN);
  });
  it('uses the known tunnel by default', () => {
    delete process.env.RUDRA_API_BASE_URL;
    expect(primaryBase()).toBe(KNOWN);
  });
  it('fetches the primary URL directly', async () => {
    process.env.RUDRA_API_BASE_URL = 'https://self-hosted.example.com';
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await rudraFetch('/api/test', { method: 'GET' }, 1000);
    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://self-hosted.example.com/api/test',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });
  it('does not fail over from an explicit override', async () => {
    process.env.RUDRA_API_BASE_URL = 'https://self-hosted.example.com';
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection failed'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(rudraFetch('/api/test', { method: 'GET' }, 1000)).rejects.toThrow('connection failed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('consults the broker after a tunnel connection failure', async () => {
    delete process.env.RUDRA_API_BASE_URL;
    const first = new Error('tunnel unavailable');
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(first)
      .mockResolvedValueOnce(new Response('https://fresh-tunnel.trycloudflare.com/', { status: 200 }))
      .mockResolvedValueOnce(new Response('recovered', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await rudraFetch('/api/test', { method: 'GET' }, 1000);
    expect(await response.text()).toBe('recovered');
    expect(fetchMock.mock.calls[2][0]).toBe('https://fresh-tunnel.trycloudflare.com/api/test');
  });
  it('returns the original error when the broker URL is invalid', async () => {
    delete process.env.RUDRA_API_BASE_URL;
    const original = new Error('connection failed');
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(original)
      .mockResolvedValueOnce(new Response('not-a-tunnel.example.com', { status: 200 })),
    );
    await expect(rudraFetch('/api/test', { method: 'GET' }, 1000)).rejects.toThrow('connection failed');
  });
  it('returns the original error when the broker is non-ok', async () => {
    delete process.env.RUDRA_API_BASE_URL;
    const original = new Error('connection failed');
    vi.stubGlobal('fetch', vi.fn()
      .mockRejectedValueOnce(original)
      .mockResolvedValueOnce(new Response('missing', { status: 503 })),
    );
    await expect(rudraFetch('/api/test', { method: 'GET' }, 1000)).rejects.toThrow('connection failed');
  });
  it('removes trailing slashes from broker URLs', async () => {
    delete process.env.RUDRA_API_BASE_URL;
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce(new Response('https://rotating-tunnel.trycloudflare.com///', { status: 200 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await rudraFetch('/api/test', { method: 'GET' }, 1000);
    expect(fetchMock.mock.calls[2][0]).toBe('https://rotating-tunnel.trycloudflare.com/api/test');
  });
});
