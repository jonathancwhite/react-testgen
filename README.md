# React Test Generator (CLI)

## How To Run

From inside of the repo:

```
pnpm install
pnpm build
pnpm link --global
```

Then, from any project:

```
# use default src as root
react-testgen

# specify a folder
react-testgen src/components

# dry run
react-testgen src/components --dry-run

# overwrite
react-testgen src/components --force
```

This creates stems, it does not fully generate tests for you. Feel free to open an issue or a PR if you want to contribute.
