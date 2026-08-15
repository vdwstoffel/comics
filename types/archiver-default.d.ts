// @types/archiver@8 declares the classes and options but omits the callable
// factory function that the runtime module actually exports. Augment the module
// with a default export matching `archiver(format, options)`.
declare module 'archiver' {
  import { Archiver, ArchiverOptions } from 'archiver'

  type Format = 'zip' | 'tar' | 'json' | (string & {})

  function archiver(format: Format, options?: ArchiverOptions): Archiver

  export default archiver
}
