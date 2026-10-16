import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// One startup snapshot. Versioned asset URLs prevent an older page that is
// still loading during a restart from receiving a different script or style.
export function snapshotClientAssets(directory) {
  const template = fs.readFileSync(path.join(directory, "index.html"), "utf8");
  const assets = new Map();
  for (const [name, type] of [["styles.css", "text/css"], ["app.js", "text/javascript"], ["recorder.css", "text/css"], ["recorder.js", "text/javascript"], ["quota.css", "text/css"], ["quota.js", "text/javascript"], ["controls.css", "text/css"], ["controls.js", "text/javascript"]]) {
    if (template.includes(`/ui/${name}`)) assets.set(`/ui/${name}`, {
      body: fs.readFileSync(path.join(directory, name)), type: `${type}; charset=utf-8`,
    });
  }
  for (const [name,type] of [["maple.css","text/css; charset=utf-8"],["fonts/SourceHanSerifSC-VF.woff2","font/woff2"],["fonts/JetBrainsMono-Regular.woff2","font/woff2"],["maple.svg","image/svg+xml"]]) {
    const file=path.join(directory,name);
    if(fs.existsSync(file))assets.set(`/ui/${name}`,{body:fs.readFileSync(file),type});
  }
  const hash = crypto.createHash("sha256").update(template);
  for (const [name, asset] of assets) hash.update(name).update(asset.body);
  const version = hash.digest("hex").slice(0, 20);
  for(const asset of assets.values())if(asset.type.startsWith('text/css'))asset.body=Buffer.from(asset.body.toString('utf8').replaceAll('__PARLEY_ASSET_VERSION__',version));
  return { html: template.replaceAll("__PARLEY_ASSET_VERSION__", version), version, assets };
}
