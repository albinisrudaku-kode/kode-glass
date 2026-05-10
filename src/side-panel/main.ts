import {bootstrapApplication} from '@angular/platform-browser';
import {provideAnimations} from '@angular/platform-browser/animations';
import {provideTaiga} from '@taiga-ui/core';
import {AppComponent} from './app/app.component';
import {logger} from '../shared/logger';

bootstrapApplication(AppComponent, {
  providers: [provideAnimations(), provideTaiga()],
}).catch(error => logger.error('Side panel bootstrap failed', error));
