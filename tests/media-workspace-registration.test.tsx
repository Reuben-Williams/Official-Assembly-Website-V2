import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EditorShell } from '@reuben-williams/editor';

describe('host media workspace integration', () => {
  it('renders the host registered media workspace instead of the built-in library', () => {
    const html = renderToStaticMarkup(<EditorShell siteId="test" currentPath="/" pages={[]} previewBaseUrl="https://example.test/"
      initialWorkspace="website.media" registration={{ modules: [], workspaces: [{
        id: 'website.media', label: 'Media', group: 'website', icon: 'images',
        render: () => <h1>Host image library with folders</h1>,
      }] }} />);
    expect(html).toContain('Host image library with folders');
    expect(html).not.toContain('No media has been uploaded yet.');
  });
});
