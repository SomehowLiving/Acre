// Some wallet/dependency packages still reference Node's global object.
if (typeof (globalThis as { global?: typeof globalThis }).global === 'undefined') {
  ;(globalThis as { global?: typeof globalThis }).global = globalThis
}
