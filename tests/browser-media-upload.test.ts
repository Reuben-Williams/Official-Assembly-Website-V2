// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { prepareBrowserMediaUpload } from '../lib/builder/media-client';
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('keeps JPEG originals unchanged', async () => {
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
  expect(canvas.width).toBe(900); expect(canvas.height).toBe(1200);
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0);
  expect(bitmap.close).toHaveBeenCalledOnce();
});
it('clearly rejects GIF rather than silently flattening animation', async () => {
  await expect(prepareBrowserMediaUpload(new File(['gif'], 'photo.gif', { type: 'image/gif' }))).rejects.toThrow('JPEG, PNG or WebP');
});
it('checks decoded dimensions before allocating a conversion canvas', async () => {
  const bitmap = { width: 9000, height: 100, close: vi.fn() };
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  await expect(prepareBrowserMediaUpload(new File(['png'], 'photo.png', { type: 'image/png' }))).rejects.toThrow('8,192');
  expect(bitmap.close).toHaveBeenCalledOnce();
});
