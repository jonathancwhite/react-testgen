import path from 'path';
import { promises as fs } from 'fs';

// ---------------- Config ----------------

const COMPONENT_EXTENSIONS = ['.tsx'];

interface ComponentExportInfo {
	importName: string;
	importLine: string;
	jsxTag: string;
}

interface CliOptions {
	rootDir: string;
	dryRun: boolean;
	force: boolean;
}

// ---------------- CLI args ----------------

function parseArgs(): CliOptions {
	const args = process.argv.slice(2);

	let rootDir = 'src';
	let dryRun = false;
	let force = false;

	for (const arg of args) {
		if (arg === '--dry-run') {
			dryRun = true;
		} else if (arg === '--force') {
			force = true;
		} else if (!arg.startsWith('-')) {
			// First non-flag arg = root dir
			rootDir = arg;
		}
	}

	return { rootDir, dryRun, force };
}

// ---------------- File discovery ----------------

async function findComponentFiles(rootDir: string): Promise<string[]> {
	const results: string[] = [];

	async function walk(dir: string) {
		let entries;
		try {
			entries = await fs.readdir(dir, { withFileTypes: true });
		} catch (err) {
			// dir may not exist
			return;
		}

		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);

			if (entry.isDirectory()) {
				if (['node_modules', 'dist', 'build', '.git'].includes(entry.name)) {
					continue;
				}
				await walk(fullPath);
			} else {
				if (
					entry.name.endsWith('.test.tsx') ||
					entry.name.endsWith('.stories.tsx') ||
					entry.name.startsWith('.')
				) {
					continue;
				}

				const ext = path.extname(entry.name);
				if (COMPONENT_EXTENSIONS.includes(ext)) {
					results.push(fullPath);
				}
			}
		}
	}

	await walk(rootDir);
	return results;
}

function getTestPath(filePath: string): string {
	const dir = path.dirname(filePath);
	const base = path.basename(filePath, path.extname(filePath));
	return path.join(dir, `${base}.test.tsx`);
}

// ---------------- Export introspection ----------------

async function inferExportInfo(filePath: string): Promise<ComponentExportInfo> {
	const source = await fs.readFile(filePath, 'utf8');
	const baseName = path.basename(filePath, path.extname(filePath));
	const testPath = getTestPath(filePath);

	const relativeImport = path
		.relative(path.dirname(testPath), filePath)
		.replace(/\\/g, '/')
		.replace(/\.tsx?$/, '');

	// 1) export default function ComponentName() { ... }
	let match = source.match(/export\s+default\s+function\s+([A-Za-z0-9_]+)/);
	if (match) {
		const name = match[1];
		return {
			importName: name,
			importLine: `import ${name} from "${relativeImport}";`,
			jsxTag: `<${name} />`,
		};
	}

	// 2) export default ComponentName;
	match = source.match(/export\s+default\s+([A-Za-z0-9_]+)/);
	if (match) {
		const name = match[1];
		return {
			importName: name,
			importLine: `import ${name} from "${relativeImport}";`,
			jsxTag: `<${name} />`,
		};
	}

	// 3) export function ComponentName(...)
	match = source.match(/export\s+function\s+([A-Za-z0-9_]+)/);
	if (match) {
		const name = match[1];
		return {
			importName: name,
			importLine: `import { ${name} } from "${relativeImport}";`,
			jsxTag: `<${name} />`,
		};
	}

	// 4) export const ComponentName = (...) => { ... }
	match = source.match(/export\s+const\s+([A-Za-z0-9_]+)\s*=\s*\(/);
	if (match) {
		const name = match[1];
		return {
			importName: name,
			importLine: `import { ${name} } from "${relativeImport}";`,
			jsxTag: `<${name} />`,
		};
	}

	// Fallback: default import with generic name based on file
	const fallbackName =
		baseName.charAt(0).toUpperCase() + baseName.slice(1) || 'ComponentUnderTest';

	return {
		importName: fallbackName,
		importLine: `import ${fallbackName} from "${relativeImport}";`,
		jsxTag: `<${fallbackName} />`,
	};
}

// ---------------- Test template ----------------

function createTestTemplate(filePath: string, exportInfo: ComponentExportInfo): string {
	const componentLabel = path.basename(filePath, path.extname(filePath));

	return `import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
${exportInfo.importLine}

describe("${componentLabel}", () => {
  it("renders without crashing", () => {
    render(${exportInfo.jsxTag});
    // TODO: replace this with meaningful assertions
    // Example:
    // expect(screen.getByText(/some text/i)).toBeInTheDocument();
  });
});
`;
}

// ---------------- Main ----------------

async function main() {
	const { rootDir, dryRun, force } = parseArgs();
	const cwd = process.cwd();
	const absoluteRoot = path.resolve(cwd, rootDir);

	console.log(`react-testgen: scanning "${absoluteRoot}"`);

	const files = await findComponentFiles(absoluteRoot);
	if (files.length === 0) {
		console.log('No component files found.');
		return;
	}

	for (const file of files) {
		const testPath = getTestPath(file);

		let testExists = false;
		try {
			await fs.access(testPath);
			testExists = true;
		} catch {
			testExists = false;
		}

		if (testExists && !force) {
			// Leave existing tests alone
			continue;
		}

		const exportInfo = await inferExportInfo(file);
		const template = createTestTemplate(file, exportInfo);

		if (dryRun) {
			console.log(`[DRY RUN] Would create: ${testPath}`);
			continue;
		}

		await fs.writeFile(testPath, template, 'utf8');
		console.log(`${testExists ? 'Overwrote' : 'Created'}: ${path.relative(cwd, testPath)}`);
	}

	console.log('react-testgen: done.');
}

main().catch((err) => {
	console.error('react-testgen: error');
	console.error(err);
	process.exit(1);
});
