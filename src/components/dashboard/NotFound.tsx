import React from 'react';

export function NotFoundPage() {
  return (
    <div style={{ textAlign: 'center' }}>
      <h1>404 - Page Not Found</h1>
      <p>Oops! This page does not exist.</p>
      <a href="/" style={{ textDecoration: 'none'}}>Take me to the homepage</a>
    </div>
  );
}