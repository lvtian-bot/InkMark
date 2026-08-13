interface UpdateInstallDependencies {
  prepareToClose: () => Promise<boolean>;
  install: () => Promise<boolean>;
}

export async function requestUpdateInstall(
  dependencies: UpdateInstallDependencies,
): Promise<boolean> {
  if (!(await dependencies.prepareToClose())) return false;
  return dependencies.install();
}
