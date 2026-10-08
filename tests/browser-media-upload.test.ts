// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { prepareBrowserMediaUpload } from '../lib/builder/media-client';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps JPEG originals unchanged', async () => {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 900, height: 1200, close: vi.fn() }));
  const file = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' });
  expect(await prepareBrowserMediaUpload(file)).toBe(file);
});
it.each(['image/png', 'image/webp'])('converts %s at original dimensions for the verified JPEG upload contract', async type => {
  const bitmap = { width: 900, height: 1200, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const canvas = document.createElement('canvas');
  const drawImage = vi.fn(); const fillRect = vi.fn();
  vi.spyOn(canvas, 'getContext').mockReturnValue({ fillStyle: '', fillRect, drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(new Blob(['jpeg'], { type: 'image/jpeg' })));
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
  const result = await prepareBrowserMediaUpload(new File(['png'], 'photo.png', { type }));
  expect(result.type).toBe('image/jpeg');
  expect(result.name).toBe('photo.jpg');
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 900, 1200);
  expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  expect(bitmap.close).toHaveBeenCalledOnce();
});
it('clearly rejects GIF rather than silently flattening animation', async () => {
  await expect(prepareBrowserMediaUpload(new File(['gif'], 'photo.gif', { type: 'image/gif' }))).rejects.toThrow('JPEG, PNG or WebP');
});
it('re-encodes files above 10 MiB and reduces quality until the upload fits', async () => {
  const bitmap = { width: 2400, height: 1600, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const canvas = document.createElement('canvas');
  vi.spyOn(canvas, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
  const encode = vi.spyOn(canvas, 'toBlob')
    .mockImplementationOnce(callback => callback(new Blob([new Uint8Array(11 * 1024 * 1024)], { type: 'image/jpeg' })))
    .mockImplementation(callback => callback(new Blob(['fits'], { type: 'image/jpeg' })));
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
  const result = await prepareBrowserMediaUpload(new File([new Uint8Array(12 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' }));
  expect(result.size).toBeLessThanOrEqual(10 * 1024 * 1024);
  expect(encode).toHaveBeenCalledTimes(2);
  expect(canvas.width).toBe(0);
  expect(bitmap.close).toHaveBeenCalledOnce();
});
it('rejects source files above the browser safety bound before decoding', async () => {
  const decode = vi.fn(); vi.stubGlobal('createImageBitmap', decode);
  const file = new File(['photo'], 'large.jpg', { type: 'image/jpeg' });
  Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 });
  await expect(prepareBrowserMediaUpload(file)).rejects.toThrow('50 MiB');
  expect(decode).not.toHaveBeenCalled();
});
it.each(['image/jpeg', 'image/png', 'image/webp'])('fits oversized %s photos inside upload limits without cropping', async type => {
  const bitmap = { width: 9504, height: 6336, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  const canvas = document.createElement('canvas');
  const drawImage = vi.fn();
  vi.spyOn(canvas, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(canvas, 'toBlob').mockImplementation(callback => callback(new Blob(['jpeg'], { type: 'image/jpeg' })));
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
  const original = new File(['photo'], type === 'image/jpeg' ? 'photo.jpg' : 'photo.png', { type });
  const prepared = await prepareBrowserMediaUpload(original);
  expect(prepared).not.toBe(original);
  expect(prepared.type).toBe('image/jpeg');
  const [, x, y, width, height] = drawImage.mock.calls[0];
  expect(width).toBeLessThanOrEqual(8192);
  expect(width * height).toBeLessThanOrEqual(40_000_000);
  expect(width / height).toBeCloseTo(1.5, 3);
  expect([x, y]).toEqual([0, 0]);
  expect(bitmap.close).toHaveBeenCalledOnce();
});
it('rejects exceptionally large decoded images before allocating a canvas', async () => {
  const bitmap = { width: 20000, height: 20000, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  await expect(prepareBrowserMediaUpload(new File(['png'], 'photo.png', { type: 'image/png' }))).rejects.toThrow('120 megapixels');
  expect(bitmap.close).toHaveBeenCalledOnce();
});
