import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./src/App.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function visit(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    functions.set(node.name.text, node.initializer.getText(ast));
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const code = ts.transpileModule(
  `const handleSaveFile = ${functions.get('handleSaveFile')}; const closeTab = ${functions.get('closeTab')}; globalThis.actions = { handleSaveFile, closeTab };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
).outputText;

const { handleCloseRequest } = await import(pathToFileURL(new URL('./src/core/closeGuard.ts', import.meta.url).href.replace(/\.ts$/, '.ts')).href).catch(async () => {
  const compiled = ts.transpileModule(
    readFileSync(new URL('./src/core/closeGuard.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} };
  const requireShim = () => ({});
  new Function('exports', 'require', 'module', compiled)(module.exports, requireShim, module);
  return module.exports;
});

const guardsCode = ts.transpileModule(
  readFileSync(new URL('./src/core/webviewGuards.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function loadGuards({ isTauri = false } = {}) {
  const listeners = { document: [], window: [] };
  const makeTarget = name => ({
    addEventListener: (type, handler, capture) => listeners[name].push({ type, handler, capture, removed: false }),
    removeEventListener: (type, handler, capture) => {
      const found = listeners[name].find(l => l.type === type && l.handler === handler && l.capture === capture);
      if (found) found.removed = true;
    },
  });
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, require: () => ({}),
    document: makeTarget('document'), window: makeTarget('window'),
  });
  context.globalThis = context;
  if (isTauri) context.isTauri = true;
  vm.runInContext(guardsCode, context);
  return { ...module.exports, listeners };
}

function harness({ path = null, fail = false, pending = null, onSave, choice = 'save' } = {}) {
  const tab = { id: 'test', title: 'test', path, content: 'unsaved', savedContent: 'original', encoding: 'UTF-8', isReadOnly: false };
  const state = { tabs: [tab], calls: [], status: '' };
  const context = {
    activeTab: tab, activeTabId: tab.id, tabsRef: { current: state.tabs },
    savingTabsRef: { current: new Set() }, editorViewRef: { current: null },
    viewMode: 'edit', displayMode: 'text', console: { error() {} },
    flushPendingContent: () => { const value = pending; pending = null; return value; },
    updateTab: (id, patch) => {
      state.tabs = state.tabs.map(item => item.id === id ? { ...item, ...patch } : item);
      context.tabsRef.current = state.tabs;
    },
    setTabs: updater => { state.tabs = updater(state.tabs); context.tabsRef.current = state.tabs; },
    setActiveTabId() {}, setStatusMessage: value => { state.status = value; },
    confirm: async () => choice, save: async () => null,
    toTabTitle: value => value, isSamePath: (a, b) => a === b,
    invoke: async (command, args) => {
      state.calls.push(command);
      if (command === 'save_file') {
        if (fail) throw new Error('disk write failed');
        await onSave?.(context, args);
      }
    },
  };
  vm.createContext(context);
  vm.runInContext(code, context);
  return { state, context, actions: context.actions };
}

for (const pending of [null, 'latest debounced edit']) {
  test(`cancelled save keeps tab and buffer, pending=${pending !== null}`, async () => {
    const { state, actions } = harness({ pending });
    await actions.closeTab('test');
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].content, pending ?? 'unsaved');
    assert.equal(state.tabs[0].savedContent, 'original');
    assert.deepEqual(state.calls, []);
  });
  test(`failed write keeps tab and buffer, pending=${pending !== null}`, async () => {
    const { state, context, actions } = harness({ path: 'existing.txt', fail: true, pending });
    await actions.closeTab('test');
    assert.equal(state.tabs[0].content, pending ?? 'unsaved');
    assert.equal(state.tabs[0].savedContent, 'original');
    assert.deepEqual(state.calls, ['save_file']);
    assert.equal(context.savingTabsRef.current.size, 0);
  });
}

test('close keeps newer edits made while saving', async () => {
  const { state, actions } = harness({ path: 'existing.txt', onSave: async context => {
    context.updateTab('test', { content: 'newer edit' });
  } });
  await actions.closeTab('test');
  assert.equal(state.tabs[0].content, 'newer edit');
  assert.equal(state.tabs[0].savedContent, 'unsaved');
});

test('save completion does not replace newer edits', async () => {
  const { state, actions } = harness({ path: 'existing.txt', onSave: async context => {
    context.updateTab('test', { content: 'newer edit' });
  } });
  await actions.handleSaveFile();
  assert.equal(state.tabs[0].content, 'newer edit');
  assert.equal(state.tabs[0].savedContent, 'unsaved');
});

test('cancelling the close-tab prompt keeps the tab open and touches nothing', async () => {
  const { state, actions } = harness({ path: 'existing.txt', choice: 'cancel' });
  await actions.closeTab('test');
  assert.equal(state.tabs.length, 1);
  assert.equal(state.tabs[0].title, 'test');
  assert.equal(state.tabs[0].content, 'unsaved');
  assert.deepEqual(state.calls, []);
});

test('choosing not to save closes the tab and deletes its cache', async () => {
  const { state, actions } = harness({ path: 'existing.txt', choice: 'discard' });
  await actions.closeTab('test');
  assert.ok(state.calls.includes('delete_cache_file'));
  assert.ok(!state.calls.includes('save_file'));
  assert.equal(state.tabs[0].title, 'Untitled1');
});

test('close guard saves all dirty tabs then destroys window', async () => {
  let destroyCalls = 0;
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  const saved = [];
  await handleCloseRequest(event, {
    dirtyTabs: [{ id: 'a', path: 'C:/a.txt' }, { id: 'b', path: null }],
    ask: async () => 'save',
    saveTab: async tab => { saved.push(tab.path); return tab.path ?? 'C:/new.txt'; },
    destroy: async () => { destroyCalls++; },
    onStatus: () => {},
  });
  assert.equal(event.prevented, true);
  assert.deepEqual(saved, ['C:/a.txt', null]);
  assert.equal(destroyCalls, 1);
});

test('close guard keeps window open when a save fails', async () => {
  let destroyCalls = 0;
  let status = '';
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  await handleCloseRequest(event, {
    dirtyTabs: [{ id: 'a', path: 'C:/a.txt' }],
    ask: async () => 'save',
    saveTab: async () => null,
    destroy: async () => { destroyCalls++; },
    onStatus: message => { assert.match(message, /保存失败/); },
  });
  assert.equal(event.prevented, true);
  assert.equal(destroyCalls, 0);
  assert.ok(true);
});

test('close guard destroys directly when user declines', async () => {
  let destroyCalls = 0;
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  await handleCloseRequest(event, {
    dirtyTabs: [{ id: 'a', path: 'C:/a.txt' }],
    ask: async () => 'discard',
    saveTab: async () => { throw new Error('must not save'); },
    destroy: async () => { destroyCalls++; },
    onStatus: () => {},
  });
  assert.equal(event.prevented, true);
  assert.equal(destroyCalls, 1);
});

test('close guard cancel (closing the prompt) keeps the window open and does not save', async () => {
  let destroyCalls = 0;
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  let prompt = null;
  await handleCloseRequest(event, {
    dirtyTabs: [{ id: 'a', path: 'C:/a.txt' }],
    ask: async (p) => { prompt = p; return 'cancel'; },
    saveTab: async () => { throw new Error('must not save'); },
    destroy: async () => { destroyCalls++; },
    onStatus: () => {},
  });
  assert.equal(event.prevented, true);
  assert.equal(destroyCalls, 0);
  assert.match(prompt.message, /未保存的修改/);
});

test('close guard passes through when nothing dirty', async () => {
  let destroyCalls = 0;
  const event = { prevented: false, preventDefault() { this.prevented = true; } };
  await handleCloseRequest(event, {
    dirtyTabs: [],
    ask: async () => { throw new Error('ask must not be called'); },
    saveTab: async () => null,
    destroy: async () => { destroyCalls++; },
    onStatus: () => {},
  });
  assert.equal(event.prevented, false);
  assert.equal(destroyCalls, 0);
});

test('reload shortcut detection covers F5 variants and Ctrl/Cmd+R only', () => {
  const { isReloadShortcut } = loadGuards();
  for (const key of ['F5']) {
    assert.equal(isReloadShortcut({ key, ctrlKey: false, metaKey: false }), true);
  }
  assert.equal(isReloadShortcut({ key: 'F5', ctrlKey: true, metaKey: false }), true);
  assert.equal(isReloadShortcut({ key: 'F5', ctrlKey: false, metaKey: false }), true);
  assert.equal(isReloadShortcut({ key: 'r', ctrlKey: true, metaKey: false }), true);
  assert.equal(isReloadShortcut({ key: 'R', ctrlKey: true, metaKey: false }), true);
  assert.equal(isReloadShortcut({ key: 'r', ctrlKey: false, metaKey: true }), true);
  for (const key of ['s', 'w', 'n', 'p', 'r']) {
    assert.equal(isReloadShortcut({ key, ctrlKey: false, metaKey: false }), false);
  }
});

test('webview guards stay inert outside Tauri', () => {
  const guards = loadGuards({ isTauri: false });
  const uninstall = guards.installWebviewGuards();
  assert.equal(typeof uninstall, 'function');
  uninstall();
  assert.equal(guards.listeners.document.length, 0);
  assert.equal(guards.listeners.window.length, 0);
});

test('webview guards block context menu and reload keys inside Tauri', () => {
  const guards = loadGuards({ isTauri: true });
  const uninstall = guards.installWebviewGuards();

  const contextMenu = guards.listeners.document.find(l => l.type === 'contextmenu');
  const keydown = guards.listeners.window.find(l => l.type === 'keydown');
  assert.ok(contextMenu, 'contextmenu listener registered on document');
  assert.equal(contextMenu.capture, true);
  assert.ok(keydown, 'keydown listener registered on window');
  assert.equal(keydown.capture, true);

  let contextPrevented = false;
  contextMenu.handler({ preventDefault: () => { contextPrevented = true; } });
  assert.equal(contextPrevented, true);

  const pressed = (key, mods = {}) => {
    let prevented = false;
    keydown.handler({ key, ctrlKey: false, metaKey: false, ...mods, preventDefault: () => { prevented = true; } });
    return prevented;
  };
  assert.equal(pressed('F5'), true);
  assert.equal(pressed('r', { ctrlKey: true }), true);
  assert.equal(pressed('r', { metaKey: true }), true);
  assert.equal(pressed('s', { ctrlKey: true }), false);
  assert.equal(pressed('w', { ctrlKey: true }), false);

  uninstall();
  assert.equal(contextMenu.removed, true);
  assert.equal(keydown.removed, true);
});

test('webview guards can keep individual features enabled', () => {
  const guards = loadGuards({ isTauri: true });
  guards.installWebviewGuards({ disableContextMenu: false, blockReloadShortcuts: false });
  assert.equal(guards.listeners.document.length, 0);
  assert.equal(guards.listeners.window.length, 0);

  const onlyKeys = loadGuards({ isTauri: true });
  onlyKeys.installWebviewGuards({ disableContextMenu: false });
  assert.equal(onlyKeys.listeners.document.length, 0);
  assert.equal(onlyKeys.listeners.window.length, 1);

  const onlyMenu = loadGuards({ isTauri: true });
  onlyMenu.installWebviewGuards({ blockReloadShortcuts: false });
  assert.equal(onlyMenu.listeners.document.length, 1);
  assert.equal(onlyMenu.listeners.window.length, 0);
});
