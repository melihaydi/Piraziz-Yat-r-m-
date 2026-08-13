This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

## Windows kurulum dosyası (.exe) oluşturma

Bu proje Electron ile masaüstü uygulaması olarak paketlenebilir. Bir kurulum dosyası (setup.exe) üretmek için:

```bash
cd frontend
npm install
npm run dist
```

Bu komut sırasıyla: Next.js production build'ini alır (`next build`), standalone sunucu için statik dosyaları kopyalar, ardından `electron-builder` ile `frontend/dist/` klasörüne bir NSIS kurulum dosyası (`BIPTerminal Setup x.x.x.exe`) üretir.

Notlar:
- Kurulum dosyası backend kodunu ve frontend'in production build'ini kendi içine gömer; ayrı bir `run_dev.bat` çalıştırmaya gerek kalmaz.
- Hedef bilgisayarda Python 3'ün kurulu ve PATH'e ekli olması gerekir - uygulama ilk açılışta kendi özel sanal ortamını (venv) otomatik oluşturup `requirements.txt`'i kurar (birkaç dakika sürebilir, bir kereliğine).
- Bu adım yalnızca gerçek bir Windows makinesinde tam olarak doğrulanabilir; bu depoda hazırlanan paketleme mantığı gözden geçirilmiş ve doğrulanmıştır, ancak kurulum dosyasının uçtan uca çalıştığını teyit etmek için bir kez gerçek bir Windows'ta kurup denemeniz önerilir.
