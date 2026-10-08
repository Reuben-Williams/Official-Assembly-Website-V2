import { readFile, writeFile } from 'node:fs/promises';

// Narrow compatibility patch for the pinned 0.3.0 package. The package otherwise
// discards host registrations for built-in Media. Fail closed on package drift.
const root = new URL('../node_modules/@reuben-williams/editor/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
if (manifest.version !== '0.3.0') throw new Error('Review the Media workspace compatibility patch for the new editor version.');
const file = new URL('src/EditorShell.tsx', root);
const source = await readFile(file, 'utf8');
const before = '    ...websiteWorkspaces,\n    ...(registration?.workspaces.filter';
const after = '    ...websiteWorkspaces.map((workspace) => workspace.id === "website.media"\n      ? registration?.workspaces.find((candidate) => candidate.id === workspace.id) ?? workspace\n      : workspace),\n    ...(registration?.workspaces.filter';
const normalized = source.replaceAll('\r\n', '\n');
if (normalized.includes(after)) {
  console.log('Editor Media workspace compatibility verified.');
} else {
  if (normalized.split(before).length !== 2) throw new Error('Editor source changed; Media workspace patch was not applied.');
  await writeFile(file, normalized.replace(before, after));
  console.log('Editor Media workspace compatibility applied.');
}

// Quick edit must use the same visual editor as the inspector, not expose HTML.
const richTextSource = (await readFile(file, 'utf8')).replaceAll('\r\n', '\n');
const plainQuickEdit = '&& !selectedRegion.target && !compact) {';
const visualQuickEdit = '&& !selectedRegion.target) {';
if (richTextSource.includes(plainQuickEdit)) {
  if (richTextSource.split(plainQuickEdit).length !== 2) throw new Error('Review the Quick edit compatibility patch.');
  await writeFile(file, richTextSource.replace(plainQuickEdit, visualQuickEdit));
} else if (!richTextSource.includes(visualQuickEdit)) {
  throw new Error('Editor source changed; visual Quick edit patch was not applied.');
}
console.log('Visual Quick edit compatibility verified.');

// Tiptap merges editorProps with its defaults. Passing undefined for block mode
// replaces those defaults and crashes createView in the pinned runtime.
const richTextFile = new URL('src/content/RichTextEditor.tsx', root);
const richText = (await readFile(richTextFile, 'utf8')).replaceAll('\r\n', '\n');
const missingProps = '      : undefined,\n    onUpdate:';
const defaultProps = '      : {},\n    onUpdate:';
if (richText.includes(missingProps)) {
  if (richText.split(missingProps).length !== 2) throw new Error('Review block editor defaults compatibility.');
  await writeFile(richTextFile, richText.replace(missingProps, defaultProps));
} else if (!richText.includes(defaultProps)) {
  throw new Error('Editor source changed; block editor defaults patch was not applied.');
}
console.log('Block editor defaults compatibility verified.');
