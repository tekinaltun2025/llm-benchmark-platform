import { NextResponse } from 'next/server';
import { requestStop, getLockStatus } from '@/lib/benchmark-lock';

/**
 * POST /api/benchmark/stop
 *
 * Çalışan benchmark koşusunu durdurmayı ister. Koşu her soru arasında
 * isStopRequested() kontrol eder ve kendini güvenli şekilde sonlandırır;
 * o ana kadarki sonuçlar DB'ye yazılmaz.
 *
 * Koşu çalışmıyorsa 409 döner (durdurulacak bir şey yok).
 */
export async function POST() {
  const status = getLockStatus();
  if (!status.isLocked) {
    return NextResponse.json(
      { success: false, message: 'Şu anda çalışan bir test koşusu yok.' },
      { status: 409 }
    );
  }

  const accepted = requestStop('Kullanıcı istedi');
  return NextResponse.json({
    success: accepted,
    message: accepted
      ? `Durdurma isteği gönderildi. "${status.lockedBy}" koşusu bir sonraki kontrol noktasında duracak.`
      : 'Durdurma isteği gönderilemedi.',
    lockedBy: status.lockedBy,
  });
}
