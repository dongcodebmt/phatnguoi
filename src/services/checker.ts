import got, { Got } from 'got';
import { createWorker } from 'tesseract.js';
import { CookieJar } from 'tough-cookie';
import { parseHTML } from 'linkedom';
import { VehicleType } from '@/enums';
import { parseDate, getValueFromObject } from '@/utils'
import { type IViolationRaw } from '@/models/violation-raw';

export class CheckerService {
  private instance: Got;
  private attempts: number = 0;
  private readonly maxAttempts: number = 5;
  private readonly captchaImgUrl: string = 'https://www.csgt.vn/lib/captcha/captcha.class.php';
  private readonly submitCaptchaUrl: string = 'https://www.csgt.vn/?mod=contact&task=tracuu_post&ajax';

  constructor() {
    const jar = new CookieJar();
    this.instance = got.extend({
      cookieJar: jar,
      followRedirect: true,
    });
  }

  public async getDataAsync(plateNumber: string, vehicleType: VehicleType): Promise<IViolationRaw[]> {
    this.attempts = 0;
    return await this.crawlDataAsync(plateNumber, vehicleType);
  }

  private async crawlDataAsync(plateNumber: string, vehicleType: VehicleType): Promise<IViolationRaw[]> {
    const finalList: any[] = [];
    const image = await this.getImageBase64Async(this.captchaImgUrl);
    const text = await this.getTextFromImageAsync(image);

    const formData = {
      BienKS: plateNumber,
      Xe: vehicleType.toString(),
      captcha: text,
      ipClient: '9.9.9.91',
      cUrl: vehicleType.toString()
    };

    const captcha = await this.instance.post(this.submitCaptchaUrl, {
      form: formData,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      responseType: 'json'
    }).json() as any;

    if (captcha?.success) {
      const result = await this.instance.get(captcha.href);

      const { document } = parseHTML(result.body);
      const container = document.querySelector("#bodyPrint123") as HTMLElement;
      if (!container) return [];

      const sections = container.innerHTML.split('<hr');

      for (const section of sections) {
        const { document: secDoc } = parseHTML(`<div>${section}</div>`);
        const rows = secDoc.querySelectorAll('div.form-group') as NodeListOf<HTMLElement>;

        const list: any[] = [];
        list.push({ label: 'unknown', value: '' });

        for (const row of rows) {
          const label = row.querySelector('label > span');
          if (label) {
            const value = row.querySelector('.form-group > div > div > span') ?? row.querySelector('.form-group > div > div');
            list.push({ label: label.innerHTML.trim(), value: value?.innerHTML.trim() })
          } else {
            list[0].value += `${row.innerHTML.trim()}\n`
          }
        }

        if (list.length > 1 || list[0].value.trim() !== '') {
          const data = this.parseData(list);
          finalList.push(data);
        }
      }

      return finalList;
    }

    if (this.attempts < this.maxAttempts) {
      this.attempts++;
      return this.crawlDataAsync(plateNumber, vehicleType);
    }
    this.attempts = 0;
    throw new Error('Max attempts reached');
  }



  private parseData(result: any): IViolationRaw {
    return <IViolationRaw>{
      plateNumber: getValueFromObject(result, 'Biển kiểm soát:'),
      plateColor: getValueFromObject(result, 'Màu biển:'),
      vehicleType: getValueFromObject(result, 'Loại phương tiện:'),
      timeOfViolation: parseDate(getValueFromObject(result, 'Thời gian vi phạm:')),
      locationOfViolation: getValueFromObject(result, 'Địa điểm vi phạm:'),
      violation: getValueFromObject(result, 'Hành vi vi phạm:'),
      status: getValueFromObject(result, 'Trạng thái:'),
      unitDetectingViolation: getValueFromObject(result, 'Đơn vị phát hiện vi phạm:'),
      placeOfSettlement: getValueFromObject(result, 'unknown')
    }
  }

  private async getImageBase64Async(url: string): Promise<string> {
    const response = await this.instance.get(url, { responseType: 'buffer' });
    return `data:image/png;base64,${response.rawBody.toString('base64')}`;
  }

  private async getTextFromImageAsync(base64img: string): Promise<string> {
    const worker = await createWorker('eng');
    const { data: { text } } = await worker.recognize(base64img);
    await worker.terminate();
    return text.replace(/  |\r\n|\n|\r/gm, '').toLocaleLowerCase();
  }
}
