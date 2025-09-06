const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const crypto = require('crypto');

class GitRepoManager {
    constructor(options = {}) {
        this.workingDir = options.workingDir;
        this.reposPath = path.join(this.workingDir, 'repos');
        this.cacheTime = options.cacheTime || 3600000; // 1 hour default
        this.cloneCache = new Map();
    }

    async init() {
        await fs.mkdir(this.reposPath, { recursive: true });
    }

    async cloneOrUpdate(repoUrl, branch = 'main') {
        const repoId = this.getRepoId(repoUrl);
        const repoPath = path.join(this.reposPath, repoId);
        const cacheKey = `${repoUrl}:${branch}`;
        
        const cached = this.cloneCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTime) {
            return repoPath;
        }
        
        const exists = await this.repoExists(repoPath);
        
        if (exists) {
            await this.updateRepo(repoPath, branch);
        } else {
            await this.cloneRepo(repoUrl, repoPath, branch);
        }
        
        this.cloneCache.set(cacheKey, {
            path: repoPath,
            timestamp: Date.now()
        });
        
        return repoPath;
    }

    async syncToContainer(repoUrl, branch, targetPath, subPath = '') {
        const repoPath = await this.cloneOrUpdate(repoUrl, branch);
        const sourcePath = subPath ? path.join(repoPath, subPath) : repoPath;
        
        await this.rsync(sourcePath, targetPath);
        
        return targetPath;
    }

    async cloneRepo(url, targetPath, branch) {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        
        const args = ['clone', '--depth', '1'];
        if (branch && branch !== 'main' && branch !== 'master') {
            args.push('-b', branch);
        }
        args.push(url, targetPath);
        
        await this.exec('git', args);
        
        if (branch === 'main' || branch === 'master') {
            try {
                await this.exec('git', ['-C', targetPath, 'checkout', branch]);
            } catch {
                // Branch might not exist, that's ok
            }
        }
    }

    async updateRepo(repoPath, branch) {
        await this.exec('git', ['-C', repoPath, 'fetch', 'origin']);
        
        if (branch) {
            await this.exec('git', ['-C', repoPath, 'checkout', branch]);
        }
        
        await this.exec('git', ['-C', repoPath, 'pull', 'origin', branch || 'HEAD']);
    }

    async rsync(source, target) {
        await fs.mkdir(target, { recursive: true });
        
        try {
            await this.exec('rsync', [
                '-av',
                '--delete',
                '--exclude=.git',
                '--exclude=node_modules',
                '--exclude=.env',
                `${source}/`,
                `${target}/`
            ]);
        } catch (err) {
            // Fallback to cp if rsync not available
            await this.exec('cp', ['-r', `${source}/.`, target]);
        }
    }

    async repoExists(repoPath) {
        try {
            const stat = await fs.stat(path.join(repoPath, '.git'));
            return stat.isDirectory();
        } catch {
            return false;
        }
    }

    getRepoId(url) {
        // Simply use the repo name from the URL as the ID
        const repoName = url.split('/').pop().replace('.git', '');
        return repoName;
    }

    async exec(command, args) {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args);
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', data => stdout += data);
            proc.stderr.on('data', data => stderr += data);
            
            proc.on('close', code => {
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    reject(new Error(`${command} failed: ${stderr || stdout}`));
                }
            });
        });
    }

    async cleanupOldRepos(maxAge = 7 * 24 * 3600000) {
        const repos = await fs.readdir(this.reposPath);
        
        for (const repo of repos) {
            const repoPath = path.join(this.reposPath, repo);
            const stat = await fs.stat(repoPath);
            
            if (Date.now() - stat.mtime.getTime() > maxAge) {
                await fs.rm(repoPath, { recursive: true, force: true });
            }
        }
    }
}

module.exports = { GitRepoManager };