// Deep review engine worker: full-strength Stockfish 19 (stockfish.js 19.0.1, single-threaded, full
// network; the loader is stockfish-full.js). The page downloads, checks and compiles the 99 MB .wasm
// itself (front/deep.js) and sends the compiled WebAssembly.Module as the first message. The loader
// would fetch and compile the file again, so here its fetch gets an empty answer and its compile step
// uses the module from the page. After that the worker speaks UCI like the normal engine.
self.onmessage = (e) => {
  const mod = e.data && e.data.module;
  if (!(mod instanceof WebAssembly.Module)) return;
  self.onmessage = null;   // the loader installs its own handler for the UCI commands that follow
  self.fetch = () => Promise.resolve(new Response(new Uint8Array(0), { status: 200, headers: { 'Content-Type': 'application/wasm' } }));
  WebAssembly.instantiateStreaming = (source, imports) => WebAssembly.instantiate(mod, imports).then((instance) => ({ module: mod, instance }));
  importScripts('stockfish-full.js');
};
