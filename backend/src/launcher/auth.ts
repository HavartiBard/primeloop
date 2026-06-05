import crypto from 'crypto';

const LAUNCHER_AUTH_SECRET = process.env.LAUNCHER_AUTH_SECRET || 'default-secret-change-me';

export function verifyAuthToken(authHeader: string): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  
  const token = authHeader.substring(7);
  return validateToken(token);
}

export function generateAuthToken(agentId: string, expiryMinutes: number = 60): string {
  const payload = {
    agentId,
    issuedAt: Date.now(),
    expiry: Date.now() + expiryMinutes * 60 * 1000
  };
  
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = crypto.createHmac('sha256', LAUNCHER_AUTH_SECRET)
    .update(`${header}.${payloadB64}`)
    .digest('base64');
  
  return `${header}.${payloadB64}.${signature}`;
}

export function validateToken(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return false;
    }
    
    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString('utf8'));
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    
    if (header.alg !== 'HS256') {
      return false;
    }
    
    const expectedSignature = crypto.createHmac('sha256', LAUNCHER_AUTH_SECRET)
      .update(`${parts[0]}.${parts[1]}`)
      .digest('base64');
    
    if (expectedSignature !== parts[2]) {
      return false;
    }
    
    if (Date.now() > payload.expiry) {
      return false;
    }
    
    return true;
  } catch (error) {
    return false;
  }
}

export function extractAgentIdFromToken(token: string): string | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return payload.agentId || null;
  } catch (error) {
    return null;
  }
}
