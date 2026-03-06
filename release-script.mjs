import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';

const type = process.argv[2] || 'patch'; // 默认 patch (0.0.x)

try {
    // 1. 读取并解析版本
    const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
    const versionParts = manifest.version.split('.').map(Number);

    // 2. 根据参数改变版本号
    if (type === 'major') {
        versionParts[0] += 1;
        versionParts[1] = 0;
        versionParts[2] = 0;
    } else if (type === 'minor') {
        versionParts[1] += 1;
        versionParts[2] = 0;
    } else {
        versionParts[2] += 1;
    }

    const newVersion = versionParts.join('.');

    // 3. 更新 manifest.json
    manifest.version = newVersion;
    writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t'));
    console.log(`✅ Version bumped to ${newVersion}`);

    // 4. Git 操作 (Tag 格式严格为 x.y.z)
    console.log('🚀 Pushing to GitHub...');
    execSync('git add .');
    execSync(`git commit -m "chore: release ${newVersion}"`);
    execSync(`git tag ${newVersion}`);
    execSync('git push');
    execSync('git push --tags');

    console.log(`🎉 Workflow triggered for ${newVersion}`);
} catch (error) {
    console.error('❌ Release failed:', error.message);
    process.exit(1);
}