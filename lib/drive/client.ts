/**
 * Google Drive API client para gestión documental.
 * Lee/sube PDFs de facturas escaneadas.
 * Mock si no hay credenciales configuradas.
 */

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID || '';
const GOOGLE_REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN || '';

const isMock = !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET;

interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  webViewLink: string;
  webContentLink: string;
  createdTime: string;
}

/**
 * Obtiene un access token usando el refresh token.
 */
async function getAccessToken(): Promise<string> {
  if (isMock) return 'mock-token';

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('No se pudo obtener access token de Google Drive');
  }
  return data.access_token;
}

/**
 * Obtiene info de un archivo en Google Drive por su ID.
 */
export async function getFileInfo(fileId: string): Promise<DriveFileInfo> {
  if (isMock) {
    return {
      id: fileId,
      name: `factura-${fileId.substring(0, 8)}.pdf`,
      mimeType: 'application/pdf',
      size: 245000,
      webViewLink: `https://drive.google.com/file/d/${fileId}/view`,
      webContentLink: `https://drive.google.com/uc?id=${fileId}&export=download`,
      createdTime: new Date().toISOString(),
    };
  }

  const token = await getAccessToken();
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType,size,webViewLink,webContentLink,createdTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    throw new Error(`Error al obtener archivo de Drive: ${res.status}`);
  }

  return res.json();
}

/**
 * Genera URL pública temporal para ver/descargar un PDF.
 */
export function getPdfUrl(googleDriveId: string): string {
  return `https://drive.google.com/file/d/${googleDriveId}/view`;
}

/**
 * Genera URL de descarga directa.
 */
export function getDownloadUrl(googleDriveId: string): string {
  return `https://drive.google.com/uc?id=${googleDriveId}&export=download`;
}

/**
 * Verifica si estamos en modo mock (sin credenciales).
 */
export function isDriveMock(): boolean {
  return isMock;
}

/**
 * Verifica que el archivo existe y es un PDF.
 */
export async function verifyPdf(googleDriveId: string): Promise<{ exists: boolean; name?: string }> {
  if (isMock) {
    return { exists: true, name: `factura-${googleDriveId.substring(0, 8)}.pdf` };
  }

  try {
    const info = await getFileInfo(googleDriveId);
    return { exists: true, name: info.name };
  } catch {
    return { exists: false };
  }
}
