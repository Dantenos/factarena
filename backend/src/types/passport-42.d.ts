declare module 'passport-42' {
  import { Strategy as PassportStrategy } from 'passport-strategy';

  export class Strategy extends PassportStrategy {
    constructor(options: {
      clientID: string;
      clientSecret: string;
      callbackURL: string;
      scope?: string[];
    }, verify: (...args: any[]) => void);
  }

  export = Strategy;
}
