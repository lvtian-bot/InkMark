interface UpdateInstallDependencies {
  prepareToClose: () => Promise<boolean>;
  install: () => Promise<boolean>;
  resumeRecoveryDrafts: () => void;
}

export async function requestUpdateInstall(
  dependencies: UpdateInstallDependencies,
): Promise<boolean> {
  if (!(await dependencies.prepareToClose())) return false;
  let installed: boolean;
  try {
    installed = await dependencies.install();
  } catch (error) {
    dependencies.resumeRecoveryDrafts();
    throw error;
  }
  if (!installed) dependencies.resumeRecoveryDrafts();
  return installed;
}
