import { NextResponse } from 'next/server';
import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(request: Request) {
  try {
    const { to, subject, body } = await request.json();

    const data = await resend.emails.send({
      // ⚠️ UPDATE THIS LINE: Using your verified oddlambda.com domain
      from: 'Chaitanya Gohar <hello@oddlambda.com>', 
      
      to: [to], 
      subject: subject,
      text: body,
    });

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Email API Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}