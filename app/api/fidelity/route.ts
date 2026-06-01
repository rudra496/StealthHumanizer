// 📊 NOOB EXPLAINER: Fidelity API endpoint
// This API route lets the frontend check how well meaning was preserved
// after humanization. It compares original and humanized text and
// returns a score + flagged sentences where meaning may have drifted.

import { computeFidelity } from '@/lib/fidelity/comparator';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { original, humanized } = await req.json();
    
    if (!original || !humanized) {
      return NextResponse.json({ error: 'Missing original or humanized text' }, { status: 400 });
    }
    
    const result = computeFidelity(original, humanized);
    
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Fidelity check failed' },
      { status: 500 }
    );
  }
}
