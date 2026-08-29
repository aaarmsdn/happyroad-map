import { rename, rm, writeFile } from "node:fs/promises";

const defaultOperations = { rename, rm, writeFile };

export async function replaceFiles(entries, operations = defaultOperations) {
  const suffix = `${process.pid}-${Date.now()}`;
  const files = entries.map(entry => ({ ...entry, tempPath: `${entry.path}.${suffix}.tmp`, backupPath: `${entry.path}.${suffix}.bak` }));
  let backedUp = 0;
  let published = 0;
  let committed = false;
  try {
    await Promise.all(files.map(file => operations.writeFile(file.tempPath, file.contents)));
    for (const file of files) {
      await operations.rename(file.path, file.backupPath);
      backedUp += 1;
    }
    for (const file of files) {
      await operations.rename(file.tempPath, file.path);
      published += 1;
    }
    committed = true;
  } catch (error) {
    const rollbackErrors = [];
    for (let index = published - 1; index >= 0; index -= 1) {
      try { await operations.rm(files[index].path, { force: true }); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    for (let index = backedUp - 1; index >= 0; index -= 1) {
      try { await operations.rename(files[index].backupPath, files[index].path); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    }
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "File replacement and rollback failed");
    throw error;
  } finally {
    await Promise.all(files.map(file => operations.rm(file.tempPath, { force: true })));
    if (committed) await Promise.all(files.map(file => operations.rm(file.backupPath, { force: true })));
  }
}
