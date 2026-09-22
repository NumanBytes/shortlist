import { BadRequestException } from '@nestjs/common';
import { CreateSkillSchema } from '@shortlist/shared';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(CreateSkillSchema);

  it('returns the parsed value, not the raw input', () => {
    expect(pipe.transform({ name: '  React  ', category: 'FRAMEWORK' })).toEqual({
      name: 'React',
      category: 'FRAMEWORK',
    });
  });

  it('rejects an invalid enum value', () => {
    expect(() => pipe.transform({ name: 'React', category: 'framework' })).toThrow(
      BadRequestException,
    );
  });

  it('rejects fields the client is not allowed to set', () => {
    expect(() =>
      pipe.transform({ name: 'Node', category: 'FRAMEWORK', isVerified: true }),
    ).toThrow(BadRequestException);
  });
});
