'use strict';
/* Without an Apple developer certificate, macOS rejects Apple-silicon apps as "damaged".
   An ad-hoc signature avoids that; users still confirm the first launch in Privacy & Security. */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
