import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Host yang boleh meminta dev resource (HMR, webpack) selain localhost.
  //
  // Next memblokir permintaan lintas-origin ke endpoint dev secara bawaan.
  // Itu gejala yang wajar saat membuka aplikasi lewat IP publik VPS, dan
  // HMR tidak akan pernah terhubung tanpa daftar ini.
  //
  // Hanya hostname yang dicocokkan: tanpa skema, tanpa port. Next juga sudah
  // mengizinkan localhost dan subdomainnya, jadi tidak perlu didaftarkan.
  //
  // Tidak berpengaruh ke produksi. `allowedDevOrigins` hanya dibaca pada mode
  // development.
  allowedDevOrigins: ["103.210.69.31"],

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;