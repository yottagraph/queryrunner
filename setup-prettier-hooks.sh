#!/bin/bash

echo "🎨 Setting up Prettier pre-commit hooks..."

# Install dependencies
echo "📦 Installing husky and lint-staged..."
npm install --save-dev husky lint-staged

# Initialize husky
echo "🐶 Initializing husky..."
npx husky init

# Create pre-commit hook
echo "🪝 Creating pre-commit hook..."
echo "npx lint-staged" > .husky/pre-commit

# Make hook executable
chmod +x .husky/pre-commit

# Add husky directory to git
git add .husky

echo "✅ Setup complete!"
echo ""
echo "Prettier will now automatically format your code on every commit."
echo "Test it by making a change and committing a file."
echo ""
echo "To bypass formatting (not recommended): git commit --no-verify"
