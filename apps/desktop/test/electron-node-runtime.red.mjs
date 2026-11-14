const major = Number.parseInt(process.versions.node.split('.')[0] ?? '', 10);

if (Number.isNaN(major) || major < 22) {
  console.error(
    `contract mismatch: Electron embedded Node runtime ${process.versions.node} does not satisfy >= 22`,
  );
  process.exit(1);
}

process.exit(0);
