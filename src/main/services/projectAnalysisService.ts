import fs from 'fs';
import path from 'path';
import type { UEProjectAnalysis } from '../../shared/types';

const SKIP_DIRS = new Set(['Saved', 'Intermediate', 'Binaries', 'DerivedDataCache', '.git', 'node_modules']);

export class ProjectAnalysisService {

  async analyzeProject(projectPath: string): Promise<UEProjectAnalysis> {
    // 1. Find and parse the .uproject file
    const files = fs.readdirSync(projectPath);
    const uprojectFile = files.find(f => f.endsWith('.uproject'));
    if (!uprojectFile) {
      throw new Error('No .uproject file found in selected folder. Please select the root of your Unreal Engine project.');
    }

    const uprojectPath = path.join(projectPath, uprojectFile);
    const projectName = uprojectFile.replace('.uproject', '');
    let engineVersion = 'Unknown';
    let plugins: Array<{ name: string; enabled: boolean }> = [];
    let modules: Array<{ name: string; type: string }> = [];

    try {
      const uprojectData = JSON.parse(fs.readFileSync(uprojectPath, 'utf-8'));
      engineVersion = uprojectData.EngineAssociation || 'Unknown';
      plugins = (uprojectData.Plugins || []).map((p: { Name: string; Enabled?: boolean }) => ({
        name: p.Name,
        enabled: p.Enabled !== false,
      }));
      modules = (uprojectData.Modules || []).map((m: { Name: string; Type?: string }) => ({
        name: m.Name,
        type: m.Type || 'Runtime',
      }));
    } catch (e) {
      console.warn('Failed to parse .uproject:', e);
    }

    // 2. Scan Content/ folder
    const contentStats = { totalAssets: 0, totalMaps: 0, byCategory: {} as Record<string, number> };
    try {
      const contentPath = path.join(projectPath, 'Content');
      if (fs.existsSync(contentPath)) {
        this.scanContent(contentPath, contentStats);
      }
    } catch (e) {
      console.warn('Failed to scan Content folder:', e);
    }

    // 3. Scan Source/ folder for module names
    const sourceModules: string[] = [];
    try {
      const sourcePath = path.join(projectPath, 'Source');
      if (fs.existsSync(sourcePath)) {
        fs.readdirSync(sourcePath, { withFileTypes: true })
          .filter(d => d.isDirectory() && !SKIP_DIRS.has(d.name))
          .forEach(d => sourceModules.push(d.name));
      }
    } catch (e) {
      console.warn('Failed to scan Source folder:', e);
    }

    // 4. Read Config/DefaultGame.ini
    const configSummary: UEProjectAnalysis['configSummary'] = {};
    try {
      const configPath = path.join(projectPath, 'Config', 'DefaultGame.ini');
      if (fs.existsSync(configPath)) {
        const ini = fs.readFileSync(configPath, 'utf-8');
        const defaultMapMatch = ini.match(/GameDefaultMap=(.+)/);
        const versionMatch = ini.match(/ProjectVersion=(.+)/);
        const gameModeMatch = ini.match(/GlobalDefaultGameMode=(.+)/);
        if (defaultMapMatch) configSummary.defaultMap = defaultMapMatch[1].trim();
        if (versionMatch) configSummary.projectVersion = versionMatch[1].trim();
        if (gameModeMatch) configSummary.gameMode = gameModeMatch[1].trim();
      }
    } catch (e) {
      console.warn('Failed to read Config:', e);
    }

    return {
      projectName,
      engineVersion,
      uprojectPath,
      plugins,
      modules,
      contentStats,
      sourceModules,
      configSummary,
      analyzedAt: Date.now(),
    };
  }

  private scanContent(
    contentPath: string,
    stats: UEProjectAnalysis['contentStats'],
    depth = 0
  ): void {
    if (depth > 2) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(contentPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;

      if (entry.isDirectory()) {
        if (depth === 0) {
          // Count assets in this top-level category directory
          const categoryCount = this.countAssetsInDir(path.join(contentPath, entry.name));
          if (categoryCount > 0) {
            stats.byCategory[entry.name] = (stats.byCategory[entry.name] || 0) + categoryCount;
            stats.totalAssets += categoryCount;
          }
        } else {
          this.scanContent(path.join(contentPath, entry.name), stats, depth + 1);
        }
      } else if (entry.isFile()) {
        if (entry.name.endsWith('.uasset')) stats.totalAssets++;
        else if (entry.name.endsWith('.umap')) stats.totalMaps++;
      }
    }
  }

  private countAssetsInDir(dirPath: string): number {
    let count = 0;
    try {
      const walk = (p: string, depth: number) => {
        if (depth > 4) return;
        const entries = fs.readdirSync(p, { withFileTypes: true });
        for (const e of entries) {
          if (SKIP_DIRS.has(e.name)) continue;
          if (e.isFile() && (e.name.endsWith('.uasset') || e.name.endsWith('.umap'))) {
            count++;
            if (e.name.endsWith('.umap')) {
              // also counted separately at the top level scan
            }
          } else if (e.isDirectory()) {
            walk(path.join(p, e.name), depth + 1);
          }
        }
      };
      walk(dirPath, 0);
    } catch {
      // ignore
    }
    return count;
  }

  generateContextText(analysis: UEProjectAnalysis): string {
    const parts: string[] = [];

    parts.push('=== UE PROJECT CONTEXT ===');
    parts.push(`Project: ${analysis.projectName}`);
    parts.push(`Engine: Unreal Engine ${analysis.engineVersion}`);

    if (analysis.sourceModules.length > 0) {
      parts.push(`C++ Modules: ${analysis.sourceModules.join(', ')}`);
    }

    const enabledPlugins = analysis.plugins.filter(p => p.enabled).map(p => p.name);
    if (enabledPlugins.length > 0) {
      // Limit to first 10 to keep context concise
      const shown = enabledPlugins.slice(0, 10);
      const extra = enabledPlugins.length - shown.length;
      parts.push(`Plugins (enabled): ${shown.join(', ')}${extra > 0 ? ` +${extra} more` : ''}`);
    }

    parts.push('');

    const { totalAssets, totalMaps, byCategory } = analysis.contentStats;
    if (totalAssets > 0 || totalMaps > 0) {
      parts.push(`Content (${totalAssets} assets, ${totalMaps} maps):`);
      const categories = Object.entries(byCategory)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8);
      if (categories.length > 0) {
        parts.push('  ' + categories.map(([cat, n]) => `${cat}: ${n}`).join(' | '));
      }
      if (totalMaps > 0) {
        parts.push(`  Maps: ${totalMaps}`);
      }
    }

    const { defaultMap, projectVersion, gameMode } = analysis.configSummary;
    if (defaultMap || projectVersion || gameMode) {
      parts.push('');
      const configParts = [];
      if (defaultMap) configParts.push(`DefaultMap=${defaultMap}`);
      if (projectVersion) configParts.push(`Version=${projectVersion}`);
      if (gameMode) configParts.push(`GameMode=${gameMode.split('.').pop()}`);
      parts.push(`Config: ${configParts.join(' | ')}`);
    }

    parts.push('===========================');

    const text = parts.join('\n');
    // Cap at ~2500 characters to avoid bloating the context
    return text.length > 2500 ? text.slice(0, 2497) + '...' : text;
  }
}
