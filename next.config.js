/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Allow .js extension imports to resolve .ts/.tsx source files.
  // Required because shared modules use .js extensions for Node ESM compat.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".js", ".ts", ".tsx"],
    };
    return config;
  },
};

export default nextConfig;
