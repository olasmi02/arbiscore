const path = require('path');

module.exports = {
  plugins: {
    // Explicit config path: Tailwind otherwise looks for its config in the process's working directory
    tailwindcss: { config: path.join(__dirname, 'tailwind.config.ts') },
    autoprefixer: {},
  },
};
