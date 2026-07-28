module.exports = {
  testDir: 'tests',
  webServer: {
    command: 'python3 -m http.server 8080',
    port: 8080,
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://localhost:8080',
    permissions: ['clipboard-read', 'clipboard-write'],
  },
};
