'use client';
import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Flip } from 'gsap/Flip';

let done = false;
export function registerGsap() {
  if (done || typeof window === 'undefined') return;
  gsap.registerPlugin(useGSAP, ScrollTrigger, Flip);
  done = true;
}
